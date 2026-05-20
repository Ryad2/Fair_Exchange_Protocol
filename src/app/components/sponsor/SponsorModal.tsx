import { useEffect, useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormSelect from "../common/FormSelect";
import { ALL_PUBLIC_KEYS } from "@/app/lib/blockchain/config";

interface SponsorModalProps {
    title: string;
    onClose: () => void;
    onConfirm: (pk: string) => void;
    id_prefix: string;
    sponsorOptions?: string[];
    helperText?: string;
}

export default function SponsorModal({
    title,
    onClose,
    onConfirm,
    id_prefix,
    sponsorOptions,
    helperText,
}: SponsorModalProps) {
    const availableSponsorOptions =
        sponsorOptions && sponsorOptions.length > 0
            ? sponsorOptions
            : ALL_PUBLIC_KEYS;
    const [pkSponsor, setPkSponsor] = useState(availableSponsorOptions[0]);

    useEffect(() => {
        if (!availableSponsorOptions.includes(pkSponsor)) {
            setPkSponsor(availableSponsorOptions[0]);
        }
    }, [availableSponsorOptions, pkSponsor]);

    const onClick = () => {
        onConfirm(pkSponsor);
        window.dispatchEvent(new Event("reloadData"));
        onClose();
    };

    return (
        <Modal onClose={onClose} title={title}>
            <div className="">
                <div className="block">
                    <FormSelect
                        id={`${id_prefix}-sponsor-pk`}
                        value={pkSponsor}
                        onChange={setPkSponsor}
                        options={availableSponsorOptions}
                    >
                        Public key
                    </FormSelect>
                    {helperText && (
                        <p className="mt-2 text-sm text-gray-700">
                            {helperText}
                        </p>
                    )}
                </div>
                <div className="flex text-center gap-8 mt-8">
                    <Button label="Confirm" onClick={onClick} />
                    <Button label="Cancel" onClick={onClose} />
                </div>
            </div>
        </Modal>
    );
}
